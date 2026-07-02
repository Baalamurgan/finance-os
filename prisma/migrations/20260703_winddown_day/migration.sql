-- Head-configurable monthly close day (drives the wind-down reminder).
ALTER TABLE "Household" ADD COLUMN "windDownDay" INTEGER;
