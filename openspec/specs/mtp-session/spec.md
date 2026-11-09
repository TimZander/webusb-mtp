# mtp-session Specification

## Purpose
Run MTP operations over a claimed transport: transaction ids, data phases, response codes,
per-operation timeouts and what happens to the connection after each kind of failure.

## Requirements

### Requirement: The session offers MTP's file operations
The session SHALL offer GetDeviceInfo, OpenSession, CloseSession, GetStorageIDs, GetStorageInfo,
GetObjectHandles (of a folder, or the storage root by default), GetObjectInfo, GetPartialObject,
SendObjectInfo, SendObject and DeleteObject, each returning its decoded data, and SHALL track
whether a session is open.

#### Scenario: Reading a device
- **WHEN** a device with folder `DATA` holding file `a.bin` is read with each read operation in turn
- **THEN** each returns the device's info, storage ids, storage info, the root's and the folder's handles, the file's info and the requested bytes, and the session is open until CloseSession

#### Scenario: Sending and deleting
- **WHEN** SendObjectInfo announces a 200,000-byte file in a folder and SendObject sends it, with progress
- **THEN** SendObjectInfo returns the new object's storage, parent and handle, progress ends at the whole container, the device holds the bytes, and DeleteObject removes the object

### Requirement: Transaction ids follow MTP's numbering
GetDeviceInfo and OpenSession SHALL use transaction id `0`. Every other operation SHALL use the
next id of a counter that starts at `1` and that a successful OpenSession resets to `1`.

#### Scenario: Ids after opening
- **WHEN** GetDeviceInfo, OpenSession, GetStorageIDs and GetStorageInfo are sent in turn
- **THEN** their transaction ids are `0`, `0`, `1` and `2`

#### Scenario: Ids after reopening
- **WHEN** GetStorageIDs and CloseSession are sent after OpenSession, then OpenSession and GetStorageIDs again
- **THEN** their transaction ids are `1`, `2`, `0` and `1`

### Requirement: A read answered without data is reported
When an operation that returns data is answered OK with no data phase, the session SHALL throw an
error saying the operation returned no data, and stay usable; GetPartialObject SHALL return empty
bytes instead.

#### Scenario: No data phase
- **WHEN** GetStorageIDs is answered OK with no data phase
- **THEN** an error saying GetStorageIDs returned no data is thrown, and the session isn't broken

### Requirement: Every answered operation is reported
After every operation the device answers, OK or not, the session SHALL report to an optional
callback the operation's code and name, the response's code and name, and the time from command
to response.

#### Scenario: Operation records
- **WHEN** GetDeviceInfo is answered OK
- **THEN** the callback receives `GetDeviceInfo`, `0x1001`, `OK`, `0x2001` and the elapsed time

### Requirement: A refused operation leaves the session usable
When the device answers an operation with a code other than OK, the session SHALL throw a
response error naming the operation and the response by name and code, and SHALL stay usable
for further operations, except an early answer to a write (below).

#### Scenario: Storage listing refused
- **WHEN** GetStorageIDs is answered `0x2002`
- **THEN** a response error for `GetStorageIDs (0x1004)` and `GeneralError (0x2002)` is thrown, the session isn't broken, and CloseSession can still be sent

### Requirement: A broken pipe stops the session
When an exchange fails before its response is read (a transfer throws, the operation times out,
or the device sends a container that isn't the expected response), the session SHALL mark itself
broken, close the device and refuse every later operation without sending it; so does a caller's
callback that throws. Decoding an OK response's data (no data, undecodable data) SHALL leave the
session usable. An early answer to a write is covered below.

#### Scenario: Transfer throws
- **WHEN** a transfer throws during GetStorageInfo
- **THEN** the error is thrown, the session is broken, the device is closed, and a later CloseSession is refused without being sent

#### Scenario: Undecodable data
- **WHEN** GetStorageInfo is answered OK with two bytes of data
- **THEN** a decoding error is thrown, the session isn't broken, and CloseSession can still be sent

### Requirement: A stale session can be reopened
When OpenSession is answered SessionAlreadyOpen (`0x201E`), left by another program, the session
SHALL throw a response error for it and stay usable, so the caller can send CloseSession and then
OpenSession again, which restarts transaction ids.

#### Scenario: Session left open by another program
- **WHEN** the device already has a session open, and OpenSession, CloseSession and OpenSession are sent
- **THEN** the first OpenSession throws a response error with code `0x201E`, the second succeeds, and later operations work

### Requirement: Operations time out
Each operation SHALL be answered within a time limit, 10 seconds unless the caller sets another.
The answer to SendObjectInfo, and to SendObject once its data is written, SHALL have a longer
limit, 60 seconds unless set. While a write's data phase is being sent, the operation's limit
SHALL count from the last chunk accepted, so a large write times out only when it stalls. A
timeout SHALL throw a timeout error naming the operation.

#### Scenario: Device stops answering
- **WHEN** the device gives no answer to GetObjectInfo within the limit
- **THEN** a timeout error naming `GetObjectInfo (0x1008)` and the limit is thrown, and the device is closed

#### Scenario: Slow answer to a write
- **WHEN** the device answers SendObjectInfo after longer than the operation limit but within the write limit
- **THEN** SendObjectInfo succeeds

#### Scenario: Slow but steady send
- **WHEN** sending an object takes longer in total than the operation limit, while each chunk is accepted within it
- **THEN** SendObject succeeds

#### Scenario: Send stalls
- **WHEN** a data phase stops being accepted
- **THEN** a timeout error for SendObject is thrown after the operation limit, and the device is closed

### Requirement: A write answered before its data is refused
When the device's answer to a write arrives and the data phase's write hasn't completed within
1 second after it, the session SHALL note that answer's code, mark itself broken, close the
device and throw a response error marked early, even when the answer was OK.

#### Scenario: Answer before the data
- **WHEN** the device answers SendObjectInfo with `0x2005` before taking its ObjectInfo
- **THEN** a note says the device answered before accepting the data, a response error with `0x2005` marked early is thrown, the data is never reported as written, and the device is closed

#### Scenario: Early OK
- **WHEN** the device answers SendObjectInfo with `0x2001` before taking its ObjectInfo
- **THEN** a response error with `0x2001` marked early is thrown, and the device is closed

#### Scenario: Answer right after the data
- **WHEN** the device's OK answer arrives before the last data packet's write completes, and the write completes within 1 second after it
- **THEN** the write succeeds and isn't treated as early

### Requirement: A write without an answer is diagnosed
When SendObjectInfo or SendObject times out, whether its data stalled or its answer was late, the
session SHALL, before closing, send the interface the class requests GetDeviceStatus (`0x67`) and
Cancel (`0x64`, code `0x4001` and the transaction id), each with a 2-second limit, and note the
outcomes. Other operations' timeouts SHALL send neither.

#### Scenario: Write gets no answer
- **WHEN** SendObjectInfo gets no answer within the write limit and the device reports DeviceBusy
- **THEN** a status request and then a cancel request are sent, a note says `MTP status: DeviceBusy (0x2019)`, a note mentions the cancel, and the device is closed

#### Scenario: Status can't be read
- **WHEN** a write times out and the control requests fail
- **THEN** a note says the status couldn't be read, and the device is still closed

#### Scenario: A control request hangs
- **WHEN** a write times out and the device never answers the status request
- **THEN** after 2 seconds a note says the status couldn't be read, the cancel is still tried, and the device is closed

#### Scenario: A note callback throws
- **WHEN** a write times out and the caller's note callback throws
- **THEN** the timeout error is thrown, the session is broken and the device is closed

#### Scenario: Read times out
- **WHEN** GetStorageIDs times out
- **THEN** no control request is sent

### Requirement: Data phases are reported
For a write, the session SHALL tell an optional callback about the data phase it is about to
send, and another once the device has accepted all of it.

#### Scenario: ObjectInfo accepted
- **WHEN** SendObjectInfo succeeds
- **THEN** both callbacks were called once with `0x100C` and the ObjectInfo bytes
