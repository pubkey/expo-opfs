import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, ScrollView } from 'react-native';
import { useEffect, useState } from 'react';
import { applyPolyfill } from 'expo-opfs';

export default function App() {
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    applyPolyfill();
    runTests();
  }, []);

  const log = (msg: string) => {
    console.log(msg);
    setLogs((prev) => [...prev, msg]);
  };

  async function runTests() {
    log('Initializing OPFS Example Tests...');
    try {
      const root = await navigator.storage.getDirectory();
      log('✓ OPFS Root Directory obtained');

      const fileHandle = await root.getFileHandle('test-ondevice.txt', { create: true });
      log('✓ FileHandle created');

      // Test 1: Write initial string
      let writable = await fileHandle.createWritable();
      const encoder = new TextEncoder();
      await writable.write(encoder.encode('1234567890'));
      await writable.close();

      let file = await fileHandle.getFile();
      let text = await file.text();
      if (text !== '1234567890') throw new Error(`Expected "1234567890", got "${text}"`);
      log('✓ Test 1 Passed: Basic string write & read');

      // Test 2: Write at specific position via WriteParams
      writable = await fileHandle.createWritable({ keepExistingData: true });
      await writable.write({ type: 'write', data: encoder.encode('ABC'), position: 3 });
      await writable.close();

      file = await fileHandle.getFile();
      text = await file.text();
      if (text !== '123ABC7890') throw new Error(`Expected "123ABC7890", got "${text}"`);
      log('✓ Test 2 Passed: Write at position (WriteParams)');

      // Test 3: Write at specific position via seek()
      writable = await fileHandle.createWritable({ keepExistingData: true });
      await writable.seek(6);
      await writable.write(encoder.encode('DEF'));
      await writable.close();

      file = await fileHandle.getFile();
      text = await file.text();
      if (text !== '123ABCDEF0') throw new Error(`Expected "123ABCDEF0", got "${text}"`);
      log('✓ Test 3 Passed: Write at position (seek)');

      // Test 4: Read specific slice using Blob.slice
      const slice = file.slice(3, 9);
      const sliceText = await slice.text();
      if (sliceText !== 'ABCDEF') throw new Error(`Expected "ABCDEF", got "${sliceText}"`);
      log('✓ Test 4 Passed: Read specific slice');

      // Test 5: Truncate down
      writable = await fileHandle.createWritable({ keepExistingData: true });
      await writable.truncate(5);
      await writable.close();

      file = await fileHandle.getFile();
      text = await file.text();
      if (text !== '123AB') throw new Error(`Expected "123AB", got "${text}"`);
      log('✓ Test 5 Passed: Truncate file down');

      // Test 6: Extend with truncate
      writable = await fileHandle.createWritable({ keepExistingData: true });
      await writable.truncate(8);
      await writable.close();

      file = await fileHandle.getFile();
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (bytes.length !== 8 || bytes[7] !== 0) throw new Error(`Expected null padding, got length ${bytes.length}`);
      log('✓ Test 6 Passed: Extend with zero-padding');

      log('✅ ALL ON-DEVICE SANITY TESTS PASSED!');

    } catch (e: any) {
      log('❌ ERROR: ' + e.message);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>OPFS polyfill On-Device Tests</Text>
      <ScrollView style={styles.scrollView}>
        {logs.map((l, i) => (
          <Text key={i} style={styles.logText} selectable={true}>{l}</Text>
        ))}
      </ScrollView>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E1E1E',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#00D8FF',
    marginBottom: 20,
  },
  scrollView: {
    flex: 1,
    width: '90%',
    backgroundColor: '#2D2D2D',
    borderRadius: 10,
    padding: 15,
    marginBottom: 40,
  },
  logText: {
    color: '#A0A0A0',
    fontFamily: 'monospace',
    marginBottom: 5,
  }
});
