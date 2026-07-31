// The toolbar icon is the only entry point: clicking it opens the side panel.
// There is no popup, so this is all the service worker has to arrange.

function openPanelOnActionClick() {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => undefined)
}

chrome.runtime.onInstalled.addListener(openPanelOnActionClick)
chrome.runtime.onStartup.addListener(openPanelOnActionClick)
