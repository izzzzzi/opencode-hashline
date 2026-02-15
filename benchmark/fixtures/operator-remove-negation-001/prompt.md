# Fix the bug in `ReactDOMClient.js`

A negation operator is accidentally applied.

The issue is on line 57.

Remove the stray logical negation.