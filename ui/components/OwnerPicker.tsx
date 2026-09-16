import React, { useEffect, useState } from "react";
import { Flex, Grid } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { settingsObjectsClient } from "@dynatrace-sdk/client-classic-environment-v2";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { SelectField, TextField, CheckboxField } from "./Field";
import { ResultBanner } from "./ResultBanner";
import { useOwnershipTeams } from "../hooks/useOwnershipTeams";
import { useCreateAction } from "../hooks/useCreateAction";
import { buildTeamPayload, slugIdentifier, type Responsibilities } from "../utils/ownership";

const NONE = "__none__";
const NEW = "__new__";

/**
 * "Who owns this?" — pick an existing ownership team or create one inline.
 * Emits the team identifier, which callers put on the SLO as a `dt.owner` tag
 * and on alerts as a `dt.owner` event property.
 */
export const OwnerPicker: React.FC<{
  value: string | null;
  onChange: (identifier: string | null) => void;
}> = ({ value, onChange }) => {
  const { teams, isLoading, error, reload } = useOwnershipTeams();
  const [choice, setChoice] = useState<string>(value ?? NONE);
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [identifierTouched, setIdentifierTouched] = useState(false);
  const [resp, setResp] = useState<Responsibilities>({
    development: true,
    security: false,
    operations: true,
    infrastructure: false,
    lineOfBusiness: false,
  });

  // Keep the identifier derived from the name until the user edits it directly.
  useEffect(() => {
    if (!identifierTouched) setIdentifier(slugIdentifier(name));
  }, [name, identifierTouched]);

  const { busy, result, execute } = useCreateAction({
    run: async () => {
      await settingsObjectsClient.postSettingsObjects({
        body: buildTeamPayload(name.trim(), identifier, resp),
      });
      await reload();
      return identifier;
    },
    successTitle: "Team created",
    failureTitle: "Could not create the team",
    describe: (id) => `“${name.trim()}” (${id}) is now an ownership team and is selected as owner.`,
  });

  const pick = (v: string) => {
    setChoice(v);
    onChange(v === NONE || v === NEW ? null : v);
  };

  const createTeam = async () => {
    const id = await execute();
    if (id) {
      setChoice(id);
      onChange(id);
    }
  };

  const options = [
    { value: NONE, label: "No owner" },
    ...teams.map((t) => ({ value: t.identifier, label: `${t.name} (${t.identifier})` })),
    { value: NEW, label: "+ Create a new team…" },
  ];

  return (
    <Flex flexDirection="column" gap={12}>
      <SelectField
        label="Owner team"
        value={choice}
        options={options}
        onChange={pick}
        hint={
          isLoading
            ? "Loading teams…"
            : error
              ? `Couldn't list teams: ${error}`
              : "Stamped as dt.owner on the SLO and on its alerts, so the Ownership app routes them."
        }
      />

      {choice === NEW && (
        <Flex flexDirection="column" gap={12}>
          <ResultBanner result={result} />
          <Grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap={12}>
            <TextField label="Team name" value={name} onChange={setName} placeholder="Payments Platform" />
            <TextField
              label="Identifier"
              value={identifier}
              onChange={(v) => {
                setIdentifierTouched(true);
                setIdentifier(slugIdentifier(v));
              }}
              hint="Lowercase, digits and underscores. This is the dt.owner value."
            />
          </Grid>
          <Flex gap={16} flexWrap="wrap">
            {(
              [
                ["development", "Development"],
                ["operations", "Operations"],
                ["security", "Security"],
                ["infrastructure", "Infrastructure"],
                ["lineOfBusiness", "Line of business"],
              ] as [keyof Responsibilities, string][]
            ).map(([k, label]) => (
              <CheckboxField
                key={k}
                label={label}
                checked={resp[k]}
                onChange={(v) => setResp((r) => ({ ...r, [k]: v }))}
              />
            ))}
          </Flex>
          <Flex gap={12} alignItems="center">
            <Button
              variant="accent"
              color="primary"
              onClick={createTeam}
              disabled={busy || !name.trim() || !identifier}
            >
              {busy ? "Creating…" : "Create team"}
            </Button>
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
              Writes to Settings (builtin:ownership.teams). Contacts and links can be added later in the Ownership app.
            </Text>
          </Flex>
        </Flex>
      )}
    </Flex>
  );
};
