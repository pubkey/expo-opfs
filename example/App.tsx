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

  const log = (msg: string) => setLogs((prev) => [...prev, msg]);

  async function runTests() {
    log('Initializing OPFS Example Tests...');
    try {
      const root = await navigator.storage.getDirectory();
      log('✓ OPFS Root Directory obtained');

      const fileHandle = await root.getFileHandle('test-ondevice.txt', { create: true });
      log('✓ FileHandle created');

      const writable = await fileHandle.createWritable();
      const testString = 'Hello from Physical Device OPFS! 🚀';
      const encoder = new TextEncoder();
      await writable.write(encoder.encode(testString));
      await writable.close();
      log('✓ Wrote string using WritableStream');

      const file = await fileHandle.getFile();
      const text = await file.text();
      log('✓ Read back from File:');
      log(`  ➔ "${text}"`);

      if (text === testString) {
        log('✅ ALL ON-DEVICE SANITY TESTS PASSED!');
      } else {
        log('❌ DATA MISMATCH ERROR');
      }

    } catch (e: any) {
      log('❌ ERROR: ' + e.message);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>OPFS polyfill On-Device Tests</Text>
      <ScrollView style={styles.scrollView}>
        {logs.map((l, i) => (
          <Text key={i} style={styles.logText}>{l}</Text>
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
