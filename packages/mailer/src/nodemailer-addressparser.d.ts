declare module "nodemailer/lib/addressparser/index.js" {
  export interface ParsedMailbox {
    name?: string;
    address: string;
    group?: ParsedMailbox[];
  }

  export default function addressparser(
    input: string,
    options?: { flatten?: boolean },
  ): ParsedMailbox[];
}
