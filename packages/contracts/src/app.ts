/** The name on the window, the menu bar, the data folder, and the commits the app makes. */
export const APP_NAME = "Stow";

/** The server reads its RPC token from the first line of stdin when this is set. A pipe is the one
 *  channel to the child that another process running as this user cannot read: `ps` shows a command
 *  line and an environment. The pipe then stays open, and the server exits when it closes. */
export const TOKEN_STDIN_ENV = "AMC_TOKEN_STDIN";
