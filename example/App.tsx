import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, ScrollView } from 'react-native';
import { useEffect, useState } from 'react';
import { applyPolyfill } from 'expo-opfs';

import { registeredSuites } from '../test/harness';
import '../test/opfs.test';
import '../test/parallel.test';

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
      log('✓ OPFS Root Directory obtained. Running ' + registeredSuites.length + ' Suites.');

      let passedCount = 0;
      let failedCount = 0;

      for (const suite of registeredSuites) {
        log(`\n▶ Suite: ${suite.name}`);

        for (const test of suite.tests) {
          try {
            // Execute all registered beforeEach hooks sequentially
            for (const hook of suite.beforeEachHooks) {
              await hook();
            }

            // Execute test
            await test.fn();

            passedCount++;
          } catch (e: any) {
            log(`❌ FAILED: ${test.name}`);
            log(`   Reason: ${e.message}`);
            failedCount++;
          }
        }
      }

      log(`\n✅ ALL SUITES COMPLETED`);
      log(`📊 Passed: ${passedCount} | Failed: ${failedCount}`);

    } catch (e: any) {
      log('❌ FATAL ERROR: ' + e.message);
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
