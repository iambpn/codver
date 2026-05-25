Read the current .gitignore file in this directory. Add the following entries to it in a clearly labeled section at the end of the file:

# Codver dev environment
docker-compose.dev.yml
bunfig.toml
.env
.codver-plan

If .gitignore doesn't exist, create it with just those entries.

IMPORTANT: Use the 'write' tool to update the file. Keep all existing entries intact and only append the new section at the end. Output ONLY the final .gitignore content (nothing else).