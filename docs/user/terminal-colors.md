# Terminal colors

Terminals use 16 standard colors for prompts, `ls` output, and other programs. Each built-in theme
(T3 Code, T3 Chat, Grove, Ocean, Ember, and Iris) comes with colors that match it, in both light
and dark mode, so switching themes recolors the terminal too. Custom and imported themes use the
default colors.

## Set your own colors

To use your own colors, such as the ones from the terminal you use elsewhere, set them for the
thread terminals on a server. Web, desktop, iPhone, and iPad all use them, whatever theme each one
shows.

Edit `settings.json` in the server's `userdata` directory and add `terminalPalette`, with a list of
16 colors for dark mode, light mode, or both, in order from color 0 to color 15:

```json
{
  "terminalPalette": {
    "dark": [
      "#494d64",
      "#ed8796",
      "#a6da95",
      "#eed49f",
      "#8aadf4",
      "#f5bde6",
      "#8bd5ca",
      "#b8c0e0",
      "#5b6078",
      "#f2a7b2",
      "#bde3b0",
      "#f4e3c1",
      "#adc5f7",
      "#f493da",
      "#a5ded6",
      "#a5adcb"
    ]
  }
}
```

Open terminals update when you save. Colors must be written as `#rrggbb`; any other entry, and any
color you leave out, keeps the theme's color. To change just a few colors, leave the others out or
write something else in their place, such as `""`. The terminal's background and text colors still
follow your theme.

To copy a Ghostty theme, take the `palette = N=#rrggbb` lines from its theme file. Each server has
its own `settings.json`, so set the colors on every server whose terminals you use. Remove
`terminalPalette` to go back to the theme's colors.
