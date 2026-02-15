# Fix the bug in `ReactNativeFiberInspector.js`

The if and else branches are swapped (condition should be negated).

The issue is in the `getInspectorDataForViewTag` function.

Swap the if and else branch bodies back to their original positions. The condition should be negated to match.