-- TOTP replay protection: store last accepted time step per confirmed TOTP method.
ALTER TABLE "UserMfaMethod" ADD COLUMN "last_totp_time_step" INTEGER;
