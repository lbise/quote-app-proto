# Keep one full-stack application until scaling requires a split

Easy Quote will start as one React Router application with server-side modules for business logic, PostgreSQL and Better Auth in the same deployable unit. We will split the deployment only when a concrete need appears, such as independently scaling the frontend and server or supporting an independently maintained external interface. This keeps early releases small while preserving a seam for later change.
