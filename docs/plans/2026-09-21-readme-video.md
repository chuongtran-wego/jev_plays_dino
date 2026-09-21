# README Video Demo Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a playable GitHub-hosted demo video near the top of the README.

**Architecture:** Convert the local MOV into a compact H.264 MP4, upload it as
a GitHub attachment, and reference the generated attachment URL from a
dedicated README section. The binary stays outside Git history while GitHub
serves it through its native video player.

**Tech Stack:** FFmpeg, GitHub Markdown, Git, GitHub web editor

---

### Task 1: Prepare the browser-compatible video

**Files:**
- Source only: `docs/jev_plays_dino.mov`
- Create locally only: `/tmp/jev_plays_dino.mp4`

**Step 1:** Use `ffmpeg` to scale the recording, encode H.264 with `yuv420p`,
and enable fast start.

**Step 2:** Run `ffprobe` and `du` to confirm H.264 encoding and a size below
10 MB. Reduce resolution or bitrate and repeat if the file is too large.

### Task 2: Upload and document the demo

**Files:**
- Modify: `README.md`

**Step 1:** Upload `/tmp/jev_plays_dino.mp4` as a GitHub Markdown attachment
for `chuongtran-wego/jev_plays_dino`.

**Step 2:** Add `## Demo` below the introduction and place the generated
attachment URL alone in its paragraph.

**Step 3:** Run `git diff --check` and inspect the README diff.

### Task 3: Publish and verify

**Files:**
- Modify: `README.md`

**Step 1:** Commit the README and planning documents with an atomic docs
commit.

**Step 2:** Push the current commit to `wego/main`.

**Step 3:** Verify the local and remote commit hashes match and inspect the
rendered README to confirm GitHub shows a playable video.
