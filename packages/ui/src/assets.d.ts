/** A picture imported for its address: the bundler puts the file beside the page and gives its URL. */
declare module "*.svg" {
  const url: string;
  export default url;
}
