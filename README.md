# JSNESx

A JavaScript NES emulator for debugging and disassembling.

Based on [JSNES], with a vanilla JS fork of the [browser UI] merged into it.

[JSNES]: https://github.com/bfirsh/jsnes
[browser UI]: https://github.com/bfirsh/jsnes-web

The primary focus of this fork is debugging and disassembly.  It exposes a
variety of tools for generating CPU traces, coverage data, watches and
breakpoints, etc.  I've also added support for battery saves, gamepads,
and recording "movies".

The emulator works on a "bring your own ROM" basis: ROMs, save files, etc,
are all stored in IndexedDB (which should allow up to 50MB).  ROMs must be
loaded into the webapp (via the `^` button in the top-right corner of the
"Select a ROM" dialog) before playing, but should remain available
indefinitely without re-browsing the hard drive every time.

Since no special server is needed, it works directly from GitHub pages:
http://shicks.github.io/jsnesx.  Only modern browsers are supported, and
only latest Chrome has been tested.
