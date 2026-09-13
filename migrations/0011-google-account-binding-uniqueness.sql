CREATE UNIQUE INDEX account_provider_subject_unique
  ON account (providerId, accountId);

CREATE UNIQUE INDEX account_user_provider_unique
  ON account (userId, providerId);
