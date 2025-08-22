import { ChatCompletion } from '../apps/model/chat-completion';

// Mock an async iterable stream that simulates OpenAI streaming
async function* createMockStream() {
  const chunks = [
    { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] },
    { choices: [{ delta: { content: ' world' }, finish_reason: null }] },
    { choices: [{ delta: { content: ', this' }, finish_reason: null }] },
    { choices: [{ delta: { content: ' is' }, finish_reason: null }] },
    { choices: [{ delta: { content: ' a' }, finish_reason: null }] },
    { choices: [{ delta: { content: ' test' }, finish_reason: null }] },
    { choices: [{ delta: { content: '.' }, finish_reason: 'stop' }] },
  ];

  for (const chunk of chunks) {
    yield chunk as any;
  }
}

async function testStreaming() {
  console.log('Testing ChatCompletion streaming...\n');

  const mockStream = createMockStream();
  const completion = new ChatCompletion(mockStream as any);

  // Test full content stream
  console.log('=== Testing contentStream (full accumulated content) ===');
  const fullContentReceived: string[] = [];
  
  completion.contentStream.subscribe({
    next: (content) => {
      console.log(`Received full content: "${content}"`);
      fullContentReceived.push(content);
    },
    complete: () => {
      console.log('Full content stream completed');
    },
  });

  // Test incremental content stream
  console.log('\n=== Testing incrementalContentStream (only new chunks) ===');
  const incrementalContentReceived: string[] = [];
  
  completion.incrementalContentStream.subscribe({
    next: (chunk) => {
      console.log(`Received incremental chunk: "${chunk}"`);
      incrementalContentReceived.push(chunk);
    },
    complete: () => {
      console.log('Incremental content stream completed');
    },
  });

  // Wait for completion
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Verify results
  console.log('\n=== Results ===');
  console.log('Full content values received:', fullContentReceived);
  console.log('Expected full content values:', [
    'Hello',
    'Hello world',
    'Hello world, this',
    'Hello world, this is',
    'Hello world, this is a',
    'Hello world, this is a test',
    'Hello world, this is a test.',
  ]);

  console.log('\nIncremental chunks received:', incrementalContentReceived);
  console.log('Expected incremental chunks:', [
    'Hello',
    ' world',
    ', this',
    ' is',
    ' a',
    ' test',
    '.',
  ]);

  // Check if the final concatenated incremental content equals the final full content
  const finalFullContent = fullContentReceived[fullContentReceived.length - 1];
  const concatenatedIncremental = incrementalContentReceived.join('');
  
  console.log('\n=== Validation ===');
  console.log(`Final full content: "${finalFullContent}"`);
  console.log(`Concatenated incremental: "${concatenatedIncremental}"`);
  console.log(`Match: ${finalFullContent === concatenatedIncremental ? '✓' : '✗'}`);

  if (finalFullContent === concatenatedIncremental) {
    console.log('\n✅ SUCCESS: Streaming is working correctly!');
    console.log('- Full content stream provides accumulated content');
    console.log('- Incremental stream provides only new chunks');
    console.log('- No duplication detected');
  } else {
    console.log('\n❌ ERROR: Content mismatch!');
  }
}

// Run the test
testStreaming().catch(console.error);
