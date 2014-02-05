/* -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */

var EXPORTED_SYMBOLS = [ "firetray" ];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/ctypes.jsm");
Cu.import("resource://firetray/ctypes/ctypesMap.jsm");
Cu.import("resource://firetray/ctypes/winnt/win32.jsm");
Cu.import("resource://firetray/ctypes/winnt/user32.jsm");
Cu.import("resource://firetray/winnt/FiretrayWin32.jsm");
Cu.import("resource://firetray/FiretrayWindow.jsm");
Cu.import("resource://firetray/commons.js");
firetray.Handler.subscribeLibsForClosing([user32]);

let log = firetray.Logging.getLogger("firetray.Window");

if ("undefined" == typeof(firetray.Handler))
  log.error("This module MUST be imported from/after FiretrayHandler !");

const FIRETRAY_XWINDOW_HIDDEN    = 1 << 0; // when minimized also
const FIRETRAY_XWINDOW_MAXIMIZED = 1 << 1;

// We need to keep long-living references to wndProcs callbacks. As they also
// happen to be ctypes pointers, we store them into real ctypes arrays.
firetray.Handler.wndProcs     = new ctypesMap(user32.WNDPROC);
firetray.Handler.wndProcsOrig = new ctypesMap(user32.WNDPROC);


firetray.Window = new FiretrayWindow();

firetray.Window.init = function() {
    this.initialized = true;
  };

firetray.Window.shutdown = function() {
  this.initialized = false;
};

firetray.Window.getVisibility = function(hwnd) {
  let style = user32.GetWindowLongW(hwnd, user32.GWL_STYLE);
  let visible = ((style & user32.WS_VISIBLE) != 0); // user32.IsWindowVisible(hwnd);
  log.debug("visible="+visible);
  return visible;
};

// firetray.Window.{show,hide} useless
firetray.Window.setVisibility = function(wid, visible) {
  log.debug("setVisibility="+visible);
  let hwnd = firetray.Win32.hexStrToHwnd(wid);
  let ret = user32.ShowWindow(hwnd, visible ? user32.SW_SHOW : user32.SW_HIDE);
  log.debug("  ShowWindow="+ret+" winLastError="+ctypes.winLastError);
  this.updateVisibility(wid, visible);
};
// firetray.Window.updateVisibility inherited

firetray.Window.wndProc = function(hWnd, uMsg, wParam, lParam) { // filterWindow
  // log.debug("wndProc CALLED: hWnd="+hWnd+", uMsg="+uMsg+", wParam="+wParam+", lParam="+lParam);

  if (uMsg === firetray.Win32.WM_TRAYMESSAGE) {
    log.debug("wndProc CALLED with WM_TRAYMESSAGE");

  } else if (uMsg === firetray.Win32.WM_TRAYMESSAGEFWD) {
    log.debug("wndProc CALLED with WM_TRAYMESSAGEFWD");

  } else if (uMsg === win32.WM_USER) {
    log.debug("wndProc CALLED with WM_USER");
  }

  let wid = firetray.Win32.hwndToHexStr(hWnd);
  let procPrev = firetray.Handler.wndProcsOrig.get(wid);
  return user32.CallWindowProcW(procPrev, hWnd, uMsg, wParam, lParam);
};

firetray.Window.restoreWndProc = function(wid) {
  let procPrev = firetray.Handler.wndProcsOrig.get(wid);
  let hwnd = firetray.Win32.hexStrToHwnd(wid);
  log.debug("hwnd="+hwnd);
  let proc = user32.WNDPROC(
    user32.SetWindowLongW(hwnd, user32.GWLP_WNDPROC,
                          ctypes.cast(procPrev, win32.LONG_PTR))
  );
  firetray.js.assert(proc == firetray.Handler.wndProcs.get(wid),
                     "Wrong WndProc replaced.");
  firetray.Handler.wndProcs.remove(wid);
  firetray.Handler.wndProcsOrig.remove(wid);
};


///////////////////////// firetray.Handler overriding /////////////////////////

/** debug facility */
firetray.Handler.dumpWindows = function() {
  let dumpStr = ""+firetray.Handler.windowsCount;
  for (let wid in firetray.Handler.windows) {
    dumpStr += " "+wid;
  }
  log.info(dumpStr);
};

firetray.Handler.registerWindow = function(win) {
  log.debug("register window");

  let baseWin = firetray.Handler.getWindowInterface(win, "nsIBaseWindow");
  let nativeHandle = baseWin.nativeHandle;
  let hwnd = nativeHandle ?
        new win32.HWND(ctypes.UInt64(nativeHandle)) :
        user32.FindWindowW("MozillaWindowClass", win.document.title);
  let wid = firetray.Win32.hwndToHexStr(hwnd);
  log.debug("=== hwnd="+hwnd+" wid="+wid+" win.document.title: "+win.document.title);

  if (this.windows.hasOwnProperty(wid)) {
    let msg = "Window ("+wid+") already registered.";
    log.error(msg);
    Cu.reportError(msg);
    return false;
  }
  this.windows[wid] = {};
  this.windows[wid].chromeWin = win;
  this.windows[wid].baseWin = baseWin;

//   SetupWnd(hwnd);

  try {
    this.windowsCount += 1;
    firetray.Window.updateVisibility(wid, true); // windows *are* visible at startup
    log.debug("window "+wid+" registered");

    let wndProc = user32.WNDPROC(firetray.Window.wndProc);
    log.debug("proc="+wndProc);
    this.wndProcs.insert(wid, wndProc);
    let procPrev = user32.WNDPROC(
      user32.SetWindowLongW(hwnd, user32.GWLP_WNDPROC,
                            ctypes.cast(wndProc, win32.LONG_PTR))
    );
    log.debug("procPrev="+procPrev+" winLastError="+ctypes.winLastError);
    // we can't store WNDPROC callbacks (JS ctypes objects) with SetPropW(), as
    // we need long-living refs.
    this.wndProcsOrig.insert(wid, procPrev);

  } catch (x) {
    if (x.name === "RangeError") // instanceof not working :-(
      win.alert(x+"\n\nYou seem to have more than "+FIRETRAY_WINDOW_COUNT_MAX
                +" windows open. This breaks FireTray and most probably "
                +firetray.Handler.appName+".");
    else win.alert(x);
  }

  firetray.Win32.acceptAllMessages(hwnd);

  log.debug("AFTER"); firetray.Handler.dumpWindows();
  return wid;
};

firetray.Handler.unregisterWindow = function(win) {
  log.debug("unregister window");

  let wid = firetray.Window.getRegisteredWinIdFromChromeWindow(win);
  if (!firetray.Handler.windows.hasOwnProperty(wid)) {
    log.error("can't unregister unknown window "+wid);
    return false;
  }

  firetray.Window.restoreWndProc(wid);

  if (!delete firetray.Handler.windows[wid])
    throw new DeleteError();
  firetray.Handler.windowsCount -= 1;
  firetray.Handler.visibleWindowsCount -= 1;

  log.debug("window "+wid+" unregistered");
  return true;
};

firetray.Handler.showWindow = function(wid) {
  return firetray.Window.setVisibility(wid, true);
};
firetray.Handler.hideWindow = function(wid) {
  return firetray.Window.setVisibility(wid, false);
};

firetray.Handler.showHideAllWindows = function() {
  log.debug("showHideAllWindows");

  log.debug("  visibleWindowsCount="+firetray.Handler.visibleWindowsCount);
  log.debug("  windowsCount="+firetray.Handler.windowsCount);
  let visibilityRate = firetray.Handler.visibleWindowsCount/firetray.Handler.windowsCount;
  log.debug("  visibilityRate="+visibilityRate);
  if ((0.5 < visibilityRate) && (visibilityRate < 1)
      || visibilityRate === 0) { // TODO: should be configurable
    firetray.Handler.showAllWindows();
  } else {
    firetray.Handler.hideAllWindows();
  }
};
