import { PluginConfig } from "@leaderboard/api";
import { WebClient } from "@slack/web-api";

let webClient: WebClient | null = null;

export function getSlackWebClient(config: PluginConfig) {
  if (webClient) {
    return webClient;
  }

  const channel = config.slackChannel as string;
  const token = config.slackApiToken as string;

  if (!channel) {
    throw new Error("'slackChannel' is not set in the plugin config");
  }

  if (!token) {
    throw new Error("'slackApiToken' is not set in the plugin config");
  }

  webClient = new WebClient(token);
  return webClient;
}
