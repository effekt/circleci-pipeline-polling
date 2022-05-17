# circleci-pipeline-polling

A GitHub action to wait for all CircleCI checks on a pipeline to succeed.

### Steps:

- Have CircleCI post event to GitHub with Pipeline ID to your branch
  - https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#workflow_dispatch
- Add a new workflow under `.github/workflows`

`.github/workflows/circleci-pipeline-polling`

README TBD
