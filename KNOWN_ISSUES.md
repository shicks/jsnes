# Known Issues

## UI

* Record/playback UI is finicky, and trying to open both at the same time
  is just broken and will cause crashes.  Should try to unify these better.
* Multiple dialog boxes can be opened at the same time that don't really make
  sense together.  E.g. two "open file" dialogs.  When we open the second one,
  we should probably just cancel the first one.
* Want a "save as" feature for movies to make forking/branching possible.
* Use of `prompt` is ugly, should make our own dialog.

## Recording

* Provide a "lock controller" mechanism - button writes require passing
  a source and if that source is locked, the write is ignored
  - when playing back a movie, lock keyboard inputs
  - provide a lock toggle on the virtual controller dialog

## Debugger

* Memory watch should print "last pc" instead of current
  - just pass PC into logMem() ?
