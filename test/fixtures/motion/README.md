# Motion fixtures

No recorded-human traces have been collected. Synthetic tests in gesture.test.ts verify mechanics only. They do not satisfy the 85% human accuracy gate.

Use controller.html?pair=CODE&debug, calibrate, enter a participant alias, select the actual intended type and record one gesture per JSON file. Collect at least 20 soft, 20 drive, 20 lob and 10 miss traces across at least two people and iPhone Safari / Android Chrome. Include walking and setting the phone down among misses. Copy the JSON files here, without changing source or labels after classification. Run npm test -- test/gesture.test.ts. The human gate skips explicitly when there are no human traces; once any are present it enforces sample counts, diversity, >=85% correct swings, and zero false positives.
