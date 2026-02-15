# Fix the bug in `ReactFlightDOMServerBrowser.js`

A comparison operator is subtly wrong.

The issue is in the `startReadingFromDebugChannelReadableStream` function.

Swap the comparison operator to the correct variant.