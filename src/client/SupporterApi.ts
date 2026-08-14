import { z } from "zod";
import { getApiBase } from "./Api";
import { getAuthHeader } from "./Auth";

export async function createSupporterCheckoutSession(): Promise<
  string | false
> {
  try {
    const authorization = await getAuthHeader();
    if (!authorization) return false;
    const response = await fetch(
      `${getApiBase()}/stripe/create-checkout-session`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorization,
        },
        body: JSON.stringify({
          offerId: "supporter-500",
          requestId: crypto.randomUUID(),
        }),
      },
    );
    if (response.status !== 201) return false;
    const parsed = z
      .object({ url: z.string().url() })
      .safeParse(await response.json());
    return parsed.success ? parsed.data.url : false;
  } catch {
    return false;
  }
}
