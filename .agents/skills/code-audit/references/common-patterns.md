# Common Bug Patterns & Complexity Anti-Patterns

Use this reference when you need a detailed checklist for auditing.

## Bug Patterns

### Off-by-One Errors
- Loop bound `<` vs `<=`
- Array index starting at 1 instead of 0
- Slice end index: `arr[0:n]` misses element at index `n`

### Comparison Mistakes
- Assignment in condition: `if (x = 5)` instead of `if (x == 5)`
- Strict vs loose equality: `==` vs `===` in JS/TS
- Swapped operands: `a < b` when `a > b` was intended

### Null/Undefined Handling
- Accessing `.property` on potentially null/undefined object without guard
- `None` attribute access in Python
- Missing `nil` check in Go

### Unreachable Code
- Code after `return`, `break`, `continue`, `throw`
- Dead branches: `if False:`, `if (false)`, `if true` with else

### Boolean Logic Errors
- De Morgan's law mistakes: `!(a && b)` ≠ `!a && !b`
- Using `&&` when `||` was intended, or vice versa
- Double negation confusion

### Error Handling
- Empty `catch`/`except` blocks that swallow errors silently
- Missing error handling on I/O, network, or file operations
- Catching generic `Exception` instead of specific types

## Complexity Anti-Patterns

### Deep Nesting
- More than 2 levels of `if` → use early returns or guard clauses
- Callback hell → use async/await or extract functions

### Long Functions
- Function body > 30 lines → consider breaking it apart
- Multiple responsibilities → one function, one job

### Flag Parameters
- `function process(data, isAsync)` → split into `processSync(data)` and `processAsync(data)`
- Boolean args force branching inside the function

### Ternary Abuse
- Nested ternaries: `a ? b ? c : d : e` → always rewrite as if/else
- Side-effect ternaries: `flag ? doA() : doB()` → use if/else
- Complex condition ternaries: `(x > 0 && y < 10) ? a : b` → extract condition into a named variable, then use if/else

### State Machine Overkill
- Simple two-state logic implemented as a state machine → use boolean or if/else
- Pattern matching on 2 cases → use if/else