# Fix the bug in `EventPluginRegistry.js`

An identifier is misspelled in multiple separate locations.

The issue is in the `publishEventForPlugin` function. The same error appears in multiple places.

Restore the identifier to its original spelling in all affected locations.