/* -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://firetray/FiretrayHandler.jsm");
Cu.import("resource://firetray/commons.js");

/**
 * firetray namespace.
 */
if ("undefined" == typeof(firetray)) {
  var firetray = {};
};

firetray.UIOptions = {

  onLoad: function() {
    if(firetray.Handler.inMailApp) {
      Cu.import("resource://firetray/FiretrayMessaging.jsm");
      this.populateTreeAccountsOrServerTypes();
    } else {
      this.hideElement("mail_tab");
    }

  },

  onQuit: function() {
    // cleaning: removeEventListener on cells
    // NOTE: not sure this is necessary on window close
    let tree = document.getElementById("ui_mail_accounts");
    for (let i=0; i < tree.view.rowCount; i++) {
      let cells = tree.view.getItemAtIndex(i).getElementsByTagName("treecell");
      if (tree.view.getLevel(i) === 0) { // serverTypes
        // account_or_server_type_excluded, account_or_server_type_order
        [cells[1], cells[2]].map(
          function(c) {
            c.removeEventListener(
              'DOMAttrModified', that._userChangeValueTreeServerTypes, true);
          });
      } else if (tree.view.getLevel(i) === 1) { // excludedAccounts
        cells[1].removeEventListener(
          'DOMAttrModified', that._userChangeValueTreeAccounts, true);
      }
    }
  },

  hideElement: function(parentId) {
    let targetNode = document.getElementById(parentId);
    targetNode.hidden = true;
  },

  _disableTreeRow: function(row, disable) {
    let that = this;
    try {
      let cells = row.childNodes; // .getElementsByTagName('treecell');
      LOG("CELLS: "+cells);
      for (let i=0; i< cells.length; i++) {
        LOG("i: "+i+", cell:"+cells[i]);
        if (disable === true) {
          cells[i].setAttribute('properties', "disabled");
          cells[i].removeEventListener(
            'DOMAttrModified', that._userChangeValueTreeAccounts, true);
          cells[i].setAttribute('editable', "false");
        } else {
          cells[i].removeAttribute('properties');
          cells[i].addEventListener(
            'DOMAttrModified', that._userChangeValueTreeAccounts, true);
          cells[i].setAttribute('editable', "true");
        }
      }
    } catch(e) {
      ERROR(e);
    }
  },

  /**
   * needed for triggering actual preference change and saving
   */
  _userChangeValueTreeAccounts: function(event) {
    if (event.attrName == "label") LOG("label changed!");
    if (event.attrName == "value") LOG("value changed!");
    document.getElementById("pane1")
      .userChangedValue(document.getElementById("ui_tree_mail_accounts"));

    firetray.Messaging.updateUnreadMsgCount();
  },

  _userChangeValueTreeServerTypes: function(event) {
    if (event.attrName === "value") { // checkbox
      let checkboxCell = event.originalTarget;
      let tree = document.getElementById("ui_tree_mail_accounts");

      let subRows = firetray.Utils.XPath(
        checkboxCell,
        'ancestor::xul:treeitem[1]/descendant::xul:treechildren//xul:treerow');
      LOG("subRows="+subRows);
      for (let i=0; i<subRows.length; i++) {
        firetray.UIOptions._disableTreeRow(
          subRows[i], (checkboxCell.getAttribute("value") === "false"));
      }

    } else if (event.attrName == "label") { // text
      // TODO: move row to new rank
    }


    this._userChangeValueTreeAccounts(event);
  },

  /**
   * NOTE: account exceptions for unread messages count are *stored* in
   * preferences as excluded, but *shown* as "not included"
   */
  populateTreeAccountsOrServerTypes: function() {
    let that = this;
    let prefPane = document.getElementById("pane1");

    let prefStr = firetray.Utils.prefService.getCharPref("mail_accounts");
    LOG("PREF="+prefStr);
    let mailAccounts = JSON.parse(prefStr);
    let serverTypes = mailAccounts["serverTypes"];
    let accountsExcluded = mailAccounts["excludedAccounts"];
    let accountsByServerType = firetray.Messaging.accountsByServerType();
    LOG(JSON.stringify(accountsByServerType));

    // sort serverTypes according to order
    let serverTypesSorted = Object.keys(serverTypes);
    serverTypesSorted.sort(function(a,b) {
      if (serverTypes[a].order
          < serverTypes[b].order)
        return -1;
      if (serverTypes[a].order
          > serverTypes[b].order)
        return 1;
      return 0; // no sorting
    });
    LOG("serverTypesSorted: "+serverTypesSorted);

    let target = document.getElementById("ui_mail_accounts");
    for (let i=0; i<serverTypesSorted.length; i++) {
      let serverTypeName = serverTypesSorted[i];

      let item = document.createElement('treeitem');
      item.setAttribute("container",true);
      item.setAttribute("open",true);

      let row = document.createElement('treerow');
      item.appendChild(row);

      // account_or_server_type_name
      let cellName = document.createElement('treecell');
      cellName.setAttribute('label',serverTypeName);
      cellName.setAttribute('editable',false);
      row.appendChild(cellName);

      // account_or_server_type_excluded => checkbox
      let cellExcluded = document.createElement('treecell');
      cellExcluded.setAttribute('value',!serverTypes[serverTypeName].excluded);
      cellExcluded.addEventListener( // CAUTION: removeEventListener in onQuit()
        'DOMAttrModified', that._userChangeValueTreeServerTypes, true);
      row.appendChild(cellExcluded);

      // account_or_server_type_order
      let cellOrder = document.createElement('treecell');
      cellOrder.setAttribute('label',serverTypes[serverTypeName].order);
      cellOrder.addEventListener( // CAUTION: removeEventListener in onQuit()
        'DOMAttrModified', that._userChangeValueTreeServerTypes, true);
      row.appendChild(cellOrder);

      target.appendChild(item);

      // add actual accounts as children
      let subChildren = document.createElement('treechildren');
      let typeAccounts = accountsByServerType[serverTypeName];
      LOG("type: "+serverTypeName+", Accounts: "+JSON.stringify(typeAccounts));
      if (typeof(typeAccounts) == "undefined")
        continue;

      for (let i=0; i<typeAccounts.length; i++) {
        let subItem = document.createElement('treeitem');
        let subRow = document.createElement('treerow');

        // account_or_server_type_name
        cell = document.createElement('treecell');
        cell.setAttribute('id', typeAccounts[i].key);
        cell.setAttribute('label',typeAccounts[i].name);
        cell.setAttribute('editable',false);
        subRow.appendChild(cell);

        // account_or_server_type_excluded => checkbox
        let cell = document.createElement('treecell');
        cell.setAttribute('value',(accountsExcluded.indexOf(typeAccounts[i].key) < 0));
        cell.addEventListener(  // CAUTION: removeEventListener in onQuit()
          'DOMAttrModified', that._userChangeValueTreeAccounts, true);
        subRow.appendChild(cell);

        // account_or_server_type_order - UNUSED (added for consistency)
        cell = document.createElement('treecell');
        cell.setAttribute('editable',false);
        subRow.appendChild(cell);

        this._disableTreeRow(
          subRow, (cellExcluded.getAttribute("value") === "false"));
        subItem.appendChild(subRow);
        subChildren.appendChild(subItem);
      }
      item.appendChild(subChildren);

    }

    let tree = document.getElementById("ui_tree_mail_accounts");
    tree.addEventListener("keypress", that.onKeyPressTreeAccountsOrServerTypes, true);
  },

  /*
   * Save the "mail_accounts" preference. This is called by the pref's system
   * when the GUI element is altered.
   */
  saveTreeAccountsOrServerTypes: function() {
    let tree = document.getElementById("ui_tree_mail_accounts");

    LOG("VIEW="+ tree.view + ", rowCount="+tree.view.rowCount);
    let prefObj = {"serverTypes":{}, "excludedAccounts":[]};
    for (let i=0; i < tree.view.rowCount; i++) {
      let accountOrServerTypeName = tree.view.getCellText(
        i, tree.columns.getNamedColumn("account_or_server_type_name"));
      let accountOrServerTypeExcluded = (
        tree.view.getCellValue(
          i, tree.columns.getNamedColumn("account_or_server_type_excluded"))
        !== 'true');
      let accountOrServerTypeOrder = parseInt(
        tree.view.getCellText(
          i, tree.columns.getNamedColumn("account_or_server_type_order")));

      LOG("account: "+accountOrServerTypeName+", "+accountOrServerTypeExcluded);

      if (tree.view.getLevel(i) === 0) { // serverTypes
        prefObj["serverTypes"][accountOrServerTypeName] =
          { order: accountOrServerTypeOrder, excluded: accountOrServerTypeExcluded };

      } else if (tree.view.getLevel(i) === 1) { // excludedAccounts
        if (!accountOrServerTypeExcluded)
          continue;
        let rowNode = tree.view.getItemAtIndex(i).firstChild; // treerow
        let rowCells = rowNode.getElementsByTagName('treecell');
        let serverKey = rowCells[0].id;
        prefObj["excludedAccounts"].push(serverKey);

      } else
        continue;

    }

    let prefStr = JSON.stringify(prefObj);
    LOG("prefStr"+prefStr);

    /* return the new prefString to be stored by pref system */
    return prefStr;
  },

  onKeyPressTreeAccountsOrServerTypes: function(event) {
    LOG("TREE KEYPRESS: "+event.originalTarget);
    let tree = document.getElementById("ui_tree_mail_accounts");
    let col = tree.editingColumn; // col.index

    // only int allowed
    if (col == tree.columns.getNamedColumn("account_or_server_type_order")) {
      let charCode = event.which || event.keyCode;
      let charStr = String.fromCharCode(charCode);
      if (!/\d/.test(charStr))
        event.preventDefault();
    }
  }

};


window.addEventListener(
  'load', function (e) {
    removeEventListener('load', arguments.callee, true);
    firetray.UIOptions.onLoad(); },
  false);
window.addEventListener(
  'unload', function (e) {
    removeEventListener('unload', arguments.callee, true);
    firetray.UIOptions.onQuit(); },
  false);
