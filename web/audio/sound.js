// Sound is off. These stubs keep old call sites quiet and never touch AudioContext.
export function initSound() {}

const noop = () => {};
export const sfx = {
  hover: noop,
  zoom: noop,
  select: noop,
  floor: noop,
  status: noop,
  tick: noop,
  panel: noop,
};
