# @leaderboard/plugin-leaderboard-slack-plugin

Leaderboard scraper to track EOD messages from a slack channel.

## Configuration

Add the plugin to your `config.yaml`:

```yaml
leaderboard:
  plugins:
    leaderboard-slack-plugin:
      source: "@leaderboard/plugin-leaderboard-slack-plugin"
      config:
        # TODO: Add your plugin configuration options here
```

## Usage

1. Build the plugin:

```bash
pnpm build
```

2. Add the plugin to your `config.yaml` (see Configuration above)

3. Run the plugin runner:

```bash
pnpm data:scrape
```

## Development

```bash
# Build the plugin
pnpm build

# Run tests
pnpm test

# Watch mode
pnpm test:watch
```

## License

MIT
