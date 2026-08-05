-- Internal staff contact phone number (not shown on tickets/public pages). Both nullable;
-- phone_country_code includes the leading "+" (e.g. "+48").
ALTER TABLE "User" ADD COLUMN "phone_country_code" TEXT;
ALTER TABLE "User" ADD COLUMN "phone_number" TEXT;
