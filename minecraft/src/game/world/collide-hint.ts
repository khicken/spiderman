// Context for blocks whose collision depends on the moving body: scaffolding and powder snow.
// moveBody sets it for one sweep. Other collide calls see active = false.
export const collideHint = {
  active: false,
  feetY: 0,
  descend: false, // sneaking: drop through scaffolding tops
  boots: false, // leather boots: walk on powder snow
  fall: 0,
};
