# YTP Video Editor

Try at https://hdelattre.github.io/YTPVideoEditor

A browser-based timeline video editor that generates FFmpeg commands. Easily cut, arrange, and apply filters to clips.
Written in pure js/html with no dependencies.

## Features

- Multi-track timeline with drag/drop, trimming, splitting, and snapping.
- Per-clip controls: speed, volume, mute, reverse, visibility, color.
- Global default video/audio filters with per-clip overrides.
- Transcript loading + search for fast dialogue navigation.
- Undo/redo and multi-select editing.

## Export

This app does not render the final video in-browser, it outputs an FFmpeg command for you to run locally in the same directory as your media files.
