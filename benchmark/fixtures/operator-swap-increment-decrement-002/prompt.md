# Fix the bug in `ReactFlightDOMClientNode.js`

An increment/decrement operator points the wrong direction.

The issue is in the `createFromNodeStream` function.

Replace the increment/decrement operator with the intended one.