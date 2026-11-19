# The Hugeicons packs

The app's glyphs are Hugeicons' Stroke Rounded set. `packages/ui` depends on the free pack,
`@hugeicons/core-free-icons`, and lists the Pro pack, `@hugeicons-pro/core-stroke-rounded`, as an
optional dependency.

With no token, `pnpm install` skips the Pro pack and the build draws the free one. Nothing else is
needed, and the build says which it drew: `[hugeicons] the Pro pack is not installed; drawing the
free pack`.

With a Hugeicons Pro licence, point pnpm at Hugeicons' registry in your own `~/.npmrc`, never in
this repository (`.npmrc` is ignored here for that reason):

    @hugeicons-pro:registry=https://npm.hugeicons.com/
    //npm.hugeicons.com/:_authToken=YOUR_TOKEN

`packages/ui/src/hugeicons.ts` is where a glyph only the Pro pack draws is given a free stand-in.
