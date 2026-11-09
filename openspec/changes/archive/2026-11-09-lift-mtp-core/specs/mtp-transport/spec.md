## Purpose

Find a USB device's MTP interface, open and claim it through WebUSB, and move MTP containers and
events over its bulk and interrupt endpoints, including the USB packet rules MTP depends on.

## ADDED Requirements

### Requirement: WebUSB availability can be checked
The library SHALL offer a check that is true only when a `window` exists, it is a secure context
and `navigator.usb` exists, so a caller can tell before asking for a device.

#### Scenario: No browser
- **WHEN** the check runs where there is no `window`
- **THEN** it returns false

#### Scenario: Insecure context
- **WHEN** the check runs in a page that isn't a secure context, with `navigator.usb` present
- **THEN** it returns false

#### Scenario: WebUSB present
- **WHEN** the check runs in a secure context with `navigator.usb` present
- **THEN** it returns true

### Requirement: The MTP interface is identified
The library SHALL choose as a device's MTP interface an alternate setting of class `0x06` (still
image) or `0xFF` (vendor-specific) with a bulk IN, a bulk OUT and an interrupt IN endpoint,
preferring class `0x06`, then the lowest interface number. It SHALL say why it chose it, and
return nothing when no alternate setting qualifies.

#### Scenario: Still-image interface present
- **WHEN** a device has a class `0xFF` interface 0 and a class `0x06` interface 1, both with the three endpoints
- **THEN** interface 1 is chosen, with its endpoint numbers, and the reason names class `0x06`

#### Scenario: Vendor-specific interface only
- **WHEN** the only interface with the three endpoints has class `0xFF`
- **THEN** that interface is chosen and the reason names class `0xFF`

#### Scenario: No candidate interface
- **WHEN** no interface of class `0x06` or `0xFF` has all three endpoints
- **THEN** no interface is returned

#### Scenario: Non-zero alternate setting
- **WHEN** a class `0x06` interface's alternate setting `0` has no endpoints and its alternate setting `1` has the three
- **THEN** alternate setting `1` and its configuration value are chosen

### Requirement: Setup claims the interface in order
Setting up a transport SHALL open the device, select the interface's configuration unless it is
already active, claim the interface, and select its alternate setting unless it is `0`, reporting
each step done to an optional callback.

#### Scenario: Unconfigured device
- **WHEN** a device with no active configuration is set up for alternate setting `0`
- **THEN** the calls are open, select configuration, claim interface, and the steps report the selected configuration

#### Scenario: Configuration already active
- **WHEN** the interface's configuration is already active
- **THEN** no configuration is selected, and the steps say it was already active

#### Scenario: Non-zero alternate setting
- **WHEN** the chosen alternate setting is `1`
- **THEN** it is selected after the interface is claimed, and the steps report it

### Requirement: Setup failures name their step
When a setup call throws, setup SHALL fail with a setup error naming the step (open, select
configuration, claim interface, select alternate setting: `open`, `selectConfiguration`,
`claimInterface`, `selectAlternateInterface`) and carrying the cause, so the caller can explain
likely causes. The library SHALL give no platform hints.

#### Scenario: Claim refused
- **WHEN** claiming the interface throws `Unable to claim interface.`
- **THEN** setup fails with a setup error whose step is `claimInterface`, not marked as timed out, whose message includes that text

### Requirement: Setup calls time out
Each setup call SHALL complete within a time limit, 10 seconds unless the caller sets another.
When one doesn't, the transport SHALL close the device and fail with a setup error naming the
step and marked as timed out.

#### Scenario: Claiming never completes
- **WHEN** claiming the interface doesn't complete within the limit
- **THEN** setup fails with a setup error for `claimInterface` marked as timed out, and the device is closed

### Requirement: Multi-transfer responses are read completely
Reading a container SHALL skip zero-length transfers before it and keep reading until the length
its header states has arrived, without waiting for a trailing zero-length packet. Bytes read past
the end of one container SHALL begin the next. A header stating fewer than 12 bytes SHALL throw.

#### Scenario: Data phase larger than one transfer
- **WHEN** a data phase of over 400 bytes arrives in 64-byte transfers
- **THEN** it is read as one data container, and the response after it is read next

#### Scenario: Data phase ending with a zero-length packet
- **WHEN** a data phase's length is an exact multiple of the bulk IN packet size and a zero-length packet follows it
- **THEN** the data is read whole, and the response is read next

#### Scenario: Impossible length
- **WHEN** a container's header states a length of 8
- **THEN** reading throws an error saying the length is impossible

#### Scenario: Exact multiple without a zero-length packet
- **WHEN** a data phase's length is an exact multiple of the packet size and the response arrives in the same transfer, with no zero-length packet between
- **THEN** the data and the response are read as two containers without waiting for a zero-length packet

### Requirement: A data phase's header goes in its own USB packet
Writing a data container SHALL send its 12-byte header in a bulk OUT transfer of its own, then the
payload in transfers of at most 64 KiB, reporting bytes sent and the total after each, and end with
a zero-length packet when a non-empty payload fills its last bulk OUT packet exactly. Some devices
lose a payload that shares the header's packet.

#### Scenario: Large payload
- **WHEN** a 150,000-byte payload is written
- **THEN** the transfers are 12, 65,536, 65,536 and 18,928 bytes, with progress after each up to 150,012 of 150,012

#### Scenario: Payload filling its last packet
- **WHEN** a 1,024-byte payload is written with a bulk OUT packet size of 512
- **THEN** the transfers are 12, 1,024 and a zero-length packet

#### Scenario: Payload not filling its last packet
- **WHEN** a 1,000-byte payload is written with a bulk OUT packet size of 512
- **THEN** the transfers are 12 and 1,000, with no zero-length packet

#### Scenario: Empty payload
- **WHEN** an empty payload is written
- **THEN** only the 12-byte header is sent

### Requirement: Events are read
Once started, the transport SHALL keep reading the interrupt endpoint and pass each decodable
event container to the caller until the transport is closed, so a device that waits for its
events to be read before answering isn't left waiting.

#### Scenario: Device holds its answer until its event is read
- **WHEN** events are being read and the device queues an ObjectAdded event after SendObjectInfo, answering only once that event has been read
- **THEN** SendObjectInfo succeeds, and the caller receives the ObjectAdded event with the new object's handle

#### Scenario: Events stop on close
- **WHEN** event reading is started and the transport is then closed
- **THEN** a read was pending while open, and none is pending after closing

### Requirement: Event reading outlasts bad reads
While reading events, a stalled interrupt endpoint SHALL be cleared and read again after 20 ms. A
read with another status that isn't OK, one shorter than a header, a malformed event, and a throw
from the caller's event callback SHALL be skipped. A read or clear that throws SHALL end event
reading.

#### Scenario: Stalled interrupt endpoint
- **WHEN** the interrupt endpoint answers with a stall
- **THEN** the endpoint is cleared once, and within the next 50 ms at most two interrupt reads are made

#### Scenario: Bad read skipped
- **WHEN** one interrupt read ends with status `babble` and the next is four bytes long, then an ObjectAdded event arrives
- **THEN** the caller receives only the ObjectAdded event

#### Scenario: Event callback throws
- **WHEN** the caller's event callback throws for one event
- **THEN** the next event is still passed on

### Requirement: The transport is released on every exit
Closing the transport SHALL release the interface and close the device, and never throw, even when
the device is already gone. Aborting it SHALL close the device without releasing the interface
first, since a release could wait on a stuck transfer.

#### Scenario: Abort
- **WHEN** a set-up transport is aborted
- **THEN** the device is closed and the interface is not released

#### Scenario: Close twice
- **WHEN** a set-up transport is closed, then closed again
- **THEN** the interface is released and the device closed, and the second close resolves without error

### Requirement: Device identifiers reach only the caller
The library SHALL write nothing to the console or any log of its own, so serial numbers and other
identifiers in USB descriptors and DeviceInfo reach only the caller, who decides what to show.

#### Scenario: No console output
- **WHEN** a device whose serial number is `SN-EXAMPLE` is found, set up, read and written, with events read, and closed
- **THEN** nothing was written to the console
