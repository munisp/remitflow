declare module "africastalking" {
  interface SmsSendInput {
    to: string[];
    message: string;
    from?: string;
  }

  interface AfricasTalkingClient {
    SMS: {
      send(input: SmsSendInput): Promise<unknown>;
    };
  }

  export default function AfricasTalking(config: {
    apiKey: string;
    username: string;
  }): AfricasTalkingClient;
}
