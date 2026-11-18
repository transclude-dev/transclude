A reporter that throws is caught. The 500 page still ships, and both the
error and the reporter's failure are logged.

Source: `/docs/config`, `onError`.

`expected/reporter.log` is written by hand. The runner keeps a log up to its
first stack frame, and the reporter's failure is logged after the error's
frames, so a second request checks the line on its own.
