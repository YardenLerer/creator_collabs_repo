/** Real CSS, compiled from the source, instead of a script that generates it
 *  in the browser. The CDN build worked in the artifact because the host
 *  supplied it; on an ordinary page it is one network request away from an
 *  unstyled screen. */
module.exports = {
  content: ["./src/**/*.{js,jsx}"],
  theme: { extend: {} },
  corePlugins: { preflight: true },
};
