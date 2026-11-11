// The build imports stylesheets as text (see scripts/build.mjs).
declare module "*.css" {
  const text: string;
  export default text;
}
