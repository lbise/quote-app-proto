# Deploy only immutable release tags

Easy Quote will not deploy on every push to `main`. GitHub Actions deploys only a new `vX.Y.Z` tag that points to a commit reachable from `main`, and Dokploy receives the published image digest for that tag. This keeps iteration on `main` separate from production releases and makes the running image identifiable and rollbackable; database changes still require backward-compatible migrations because an image rollback does not undo a migration.
