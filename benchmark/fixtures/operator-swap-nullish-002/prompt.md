# Fix the bug in `EnterLeaveEventPlugin.js`

A nullish coalescing operator was swapped.

The issue is in the `extractEvents` function.

Use the intended nullish/logical operator.