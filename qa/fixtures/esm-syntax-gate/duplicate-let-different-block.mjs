// Control fixture: same identifier reused, but in genuinely DIFFERENT
// block scopes (each inside its own if-block). This is NOT a duplicate
// declaration error under either goal -- included so the regression
// test proves the gate is not simply flagging every re-used name.
function branchExample(flag) {
  let result = null;
  if (flag) {
    let value = 1;
    result = value;
  }
  if (!flag) {
    let value = 2;
    result = value;
  }
  return result;
}
export { branchExample };
