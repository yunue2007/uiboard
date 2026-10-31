export const SCREEN_PRESETS = Object.freeze({
  pc: Object.freeze({ label: 'PC', width: 1280, height: 800 }),
  mobile: Object.freeze({ label: 'スマホ', width: 390, height: 844 }),
});
export const SCREEN_BACKGROUND = '#ffffff';
export const NODE_STYLES = Object.freeze({
  text: Object.freeze({ fill: 'transparent', color: '#30343b', radius: 0 }),
  button: Object.freeze({ fill: '#dde1e5', color: '#30343b', radius: 0 }),
  input: Object.freeze({ fill: '#f4f5f6', color: '#30343b', radius: 0 }),
  card: Object.freeze({ fill: '#eeeeef', color: '#30343b', radius: 0 }),
  image: Object.freeze({ fill: '#dde8f2', color: '#526a80', radius: 0 }),
  badge: Object.freeze({ fill: '#e4e6e8', color: '#30343b', radius: 0 }),
  divider: Object.freeze({ fill: '#cbd0d5', color: '#30343b', radius: 0 }),
});
export function screenPresetKey(screen) {
  return Object.keys(SCREEN_PRESETS).find(key => SCREEN_PRESETS[key].width === screen.width && SCREEN_PRESETS[key].height === screen.height) ?? '';
}
export function withFixedAppearance(board) {
  const result = structuredClone(board);
  for (const screen of result.screens) {
    screen.background = SCREEN_BACKGROUND;
    for (const node of screen.nodes) Object.assign(node, NODE_STYLES[node.type]);
  }
  return result;
}
