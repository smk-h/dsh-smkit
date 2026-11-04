/**
 * The line the dialog tells the user to run.
 *
 * `add <name>@<version>` rather than `update <name>`: `update` follows whatever
 * spec the profile already declares (a `github:` tag stays on that tag, a
 * `link:` checkout stays a checkout), while `add` with an explicit version is
 * the one form that lands the release the check just found, whatever the
 * profile was installed from. It is also the form upstream's docs use.
 *
 * The profile is named because `dsh plugin` writes into one profile's
 * `node_modules`, and a bare command would leave the user guessing which.
 */

/** Build the install command for one profile. */
export function installCommand(profile: string, packageName: string, version: string): string {
  return `dsh plugin --profile ${profile} add ${packageName}@${version}`
}
