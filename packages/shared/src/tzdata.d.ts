declare module "tzdata" {
  const tzdata: {
    zones: Record<string, readonly unknown[] | string>;
  };

  export default tzdata;
}
