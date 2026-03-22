# RetroAssembly N64

Nintendo 64 support for RetroAssembly, built around **N64Wasm** with working save/load states, **Continue** support, save thumbnails, proper **4:3** display, and RetroAssembly UI/overlay integration.

## Overview

This project adds playable **Nintendo 64** support to RetroAssembly by integrating an N64Wasm-based runtime along with the platform assets, metadata, UI wiring, emulator portal components, and state-management logic needed to make the platform feel native inside RetroAssembly.

The working build includes support for:

- Nintendo 64 platform registration
- N64Wasm browser runtime
- Save and load states
- A working **Continue** button
- Save thumbnails
- Proper **4:3** display
- RetroAssembly ESC menu / overlay support
- Focus handoff between gameplay and the RetroAssembly UI
- Scrollbar and FPS overlay cleanup

## Features

### Nintendo 64 platform support
Adds Nintendo 64 as a usable platform inside RetroAssembly, including platform assets and supporting metadata.

### N64Wasm runtime integration
Includes the browser-based N64 runtime and related support files under `public/n64wasm/`.

### Save and load states
Supports save states and load states from the RetroAssembly game overlay.

### Working Continue button
The **Continue** button correctly launches the game and loads the selected save state on startup.

### Save thumbnails
Save state thumbnails are generated and shown inside the RetroAssembly UI.

### Proper 4:3 presentation
The N64 display is shown in a centered **4:3** layout instead of being stretched to the full screen width.

### RetroAssembly UI integration
The RetroAssembly overlay and ESC menu work correctly with N64 gameplay.

## ROM Format

Nintendo 64 ROMs should be provided as **unzipped `.z64` files**.

- Supported format: `.z64`
- ROMs should be **extracted / unzipped** before use
- Do **not** load zipped ROM archives directly

## Working Behavior

Current working behavior includes:

- Nintendo 64 appears as a supported platform
- N64 games launch correctly
- ROMs load correctly when provided as unzipped `.z64` files
- The RetroAssembly ESC menu opens correctly
- Save states work
- Load states work
- **Continue** loads the selected save state
- Save thumbnails work
- N64 is displayed in the correct **4:3** aspect ratio
- No unwanted scrollbar is shown
- FPS overlay is hidden

## Important Implementation Note

The working **Continue** behavior is handled through a startup handoff flow:

1. `use-emulator.ts` stores the launch-state URL
2. `n64wasm-frame.tsx` passes that state into the iframe as a query parameter
3. `public/n64wasm/script.js` reads the state value and imports the selected save after emulator startup

This approach proved more reliable than trying to inject the selected state later through a post-launch hook timing path.

## Included Areas

This project includes changes in areas such as:

- `public/n64wasm/`
- `public/platforms/...` Nintendo 64 platform artwork
- N64 core option files
- emulator portal frame and bridge files
- shared emulator and overlay hooks
- ROM and platform integration files needed to register Nintendo 64 in RetroAssembly

## Installation

Copy the included files into the matching paths in a RetroAssembly source tree, then build RetroAssembly normally.

This repository is intended to be used together with the full RetroAssembly project source. It is not a standalone replacement for the full RetroAssembly repository.

## Notes

This implementation was tested with a working N64 integration that includes:

- startup state handoff for **Continue**
- stable overlay focus behavior
- thumbnail capture support
- N64-specific layout fixes for proper presentation

## License

Use the same license terms as the RetroAssembly base project unless otherwise noted.
