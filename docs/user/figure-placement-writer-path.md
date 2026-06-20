# Figure Placement Writer Path

This plan keeps the common writing workflow direct: the writer places the cursor,
chooses a staged image, clicks `Place Figure`, and gets an editable HTML figure
in the draft. Planning and batch execution remain advanced workflow commands.

## Product Intent

- Use `Figure` language for the writer-facing action.
- Treat the markdown draft as the source of truth for caption prose.
- Avoid a caption acceptance prompt in the common path.
- Keep ledger, asset repository, and reversibility state behind the UI.
- Preserve planned placement as a queue feature, separate from direct placement.

## Common Path

1. Writer opens a markdown draft.
2. Writer places the cursor where the figure should appear.
3. Writer clicks `Place Figure` in the image staging panel.
4. OAT creates a placement record with a generated editable caption.
5. OAT publishes the asset into the image repository.
6. OAT inserts an HTML `<figure>` snippet at the cursor or selection.
7. OAT saves the draft and marks the ledger placement as placed.
8. OAT shows a success message with a future `Undo Placement` affordance.
9. Writer edits the `<figcaption>` directly in VS Code.

## Advanced Path

Planned placement remains available through command-palette workflows:

- `OAT Images: Prepare Planned Placement Run`
- `OAT Images: Execute Planned Placement Run`
- future: `OAT Images: Plan Figure Placement`

The staging panel button should not create a planned placement unless the UI
explicitly labels that action as planning or queueing.

## Reversibility

Direct placement must record enough state for a future OAT-level undo command.
VS Code undo can reverse the text edit, but it cannot safely reverse ledger
state, image repository commits, pushed assets, or placement status.

Future undo behavior:

- Remove the inserted figure snippet from the draft when it still matches.
- Mark the placement as removed in the ledger.
- Leave an auditable trail of the original placement.
- Optionally remove or supersede newly published image assets when no other
  placement references them.

## Implementation Checklist

- Rename the panel button from `Place` to `Place Figure`.
- Remove the caption input prompt from panel placement.
- Generate a default caption from the image metadata.
- Save the placement record as an internal pipeline step.
- Immediately call the existing `placeAsset` pipeline.
- Reuse the planned-placement snippet writer where practical.
- Keep planned placement commands intact.
- Add tests for direct figure placement from the panel.
- Add tests that the generated figure caption can be edited in the document.
