# Fix the bug in `TimelineContext.js`

Optional chaining was removed from a property access.

The issue is in the `TimelineContextController` function.

Restore the optional chaining operator (`?.`) at the ONE location where it was removed. Do not add optional chaining elsewhere.