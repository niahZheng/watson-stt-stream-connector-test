
const StreamingSessionState = require('./StreamingSessionState');

class GenesysStreamingSessionState extends StreamingSessionState {

    //  Counts used to track message exchanges with Genesys
    clientSeq = 0;
    serverSeq = 0;

    //  Counts used to track
    eventCount = 0;

    //  Used for debugging
    receivedBufferCount = 0;

    //  Used to track the state machine of the session.
    state = 'connected';

    constructor(message){
        super(message.id);

        this.organizationId = message.parameters.organizationId;
        this.conversationId = message.parameters.conversationId;

        this.agent_id = message.agent_id; // this is added in manually from the front-end UI for now to let us isolate the agent ID

        //  Extract all the participaten information.
        //  Currently, the Genesys AudioHook participant only ever represents the customer. The agent participant is not
        //  currently being monitored by Genesys. This may change in the future.
        //  Here is an example of a participant object:
        //      
        //          "participant": {
        //                  "id": "883efee8-3d6c-4537-b500-6d7ca4b92fa0",
        //                  "ani": "+1-555-555-1234",
        //                  "aniName": "John Doe",
        //                  "dnis": "+1-800-555-6789"
        //                }

        this.participant = message.parameters.participant;
    }
}
module.exports = GenesysStreamingSessionState;