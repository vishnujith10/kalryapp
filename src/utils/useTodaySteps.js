// utils/useTodaySteps.js - FIXED IMPORTS
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pedometer } from 'expo-sensors';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import supabase from '../lib/supabase';
import { calculateStepCalories } from './calorieCalculator';

const useTodaySteps = () => {
  const [stepsToday, setStepsToday] = useState(0);
  const [isPedometerAvailable, setIsPedometerAvailable] = useState(false);
  const [distanceKm, setDistanceKm] = useState(0);
  const [calories, setCalories] = useState(0);
  const [error, setError] = useState(null);
  const [debugInfo, setDebugInfo] = useState('Initializing...');
  const [diagnostics, setDiagnostics] = useState({
    pedometerSupported: false,
    permissionsGranted: false,
    sensorActive: false,
    lastEventTime: null,
    totalEvents: 0
  });
  const [userId, setUserId] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  
  // Use ref for debounce timeout to persist across renders
  const saveStepsTimeoutRef = useRef(null);

  // Step validation parameters - STRICTER to prevent false positives
  const STEP_COOLDOWN = 500; // 500ms between events (prevents small movements)
  const MIN_STEP_COUNT = 2; // Require at least 2 steps to filter out noise
  const MAX_STEPS_PER_EVENT = 3; // Cap at 3 steps per event (normal walking pace)

  const getTodayDateString = () => {
    const today = new Date();
    return today.toISOString().slice(0, 10);
  };

  const loadSavedSteps = async () => {
    try {
      const todayKey = `steps_${getTodayDateString()}`;
      const savedSteps = await AsyncStorage.getItem(todayKey);
      return savedSteps ? parseInt(savedSteps, 10) : 0;
    } catch (error) {
      console.log('Error loading saved steps:', error);
      return 0;
    }
  };

  const saveSteps = async (steps) => {
    try {
      const todayKey = `steps_${getTodayDateString()}`;
      await AsyncStorage.setItem(todayKey, steps.toString());
    } catch (error) {
      console.log('Error saving steps:', error);
    }
  };

  // Immediate save function (bypasses debounce for manual additions)
  const saveStepsToDatabaseImmediate = useCallback(async (steps, distance, caloriesBurned, goalValue = null) => {
    if (!userId) return;
    
    // Clear any pending debounced save
    if (saveStepsTimeoutRef.current) {
      clearTimeout(saveStepsTimeoutRef.current);
      saveStepsTimeoutRef.current = null;
    }
    
    try {
      const today = getTodayDateString();
      
      // Check if entry exists for today
      const { data: existing } = await supabase
        .from('steps')
        .select('*')
        .eq('user_id', userId)
        .eq('date', today)
        .maybeSingle();
      
      const upsertData = {
        user_id: userId,
        date: today,
        steps: steps,
        distance: distance,
        calories: caloriesBurned
      };
      
      // Include goal if provided, or preserve existing goal
      if (goalValue !== null) {
        upsertData.goal = goalValue;
      } else if (existing?.goal) {
        upsertData.goal = existing.goal;
      }
      
      // Use UPSERT to update existing record or insert new one
      const { error } = await supabase
        .from('steps')
        .upsert(upsertData, {
          onConflict: 'user_id,date',
          ignoreDuplicates: false
        });
      
      if (error) {
        console.error('Error upserting steps immediately:', error);
      } else {
        console.log('✅ Steps saved immediately to database');
      }
    } catch (error) {
      console.error('Error saving steps to database immediately:', error);
    }
  }, [userId]);

  // Debounce function to prevent too frequent database saves
  const saveStepsToDatabase = useCallback(async (steps, distance, caloriesBurned, goalValue = null) => {
    if (!userId) return;
    
    // Clear any pending save
    if (saveStepsTimeoutRef.current) {
      clearTimeout(saveStepsTimeoutRef.current);
      saveStepsTimeoutRef.current = null;
    }
    
    // Debounce: only save after 2 seconds of no updates
    saveStepsTimeoutRef.current = setTimeout(async () => {
      try {
        const today = getTodayDateString();
        
        // Check if entry exists for today (use maybeSingle to avoid errors)
        const { data: existing } = await supabase
          .from('steps')
          .select('*')
          .eq('user_id', userId)
          .eq('date', today)
          .maybeSingle();
        
        const upsertData = {
          user_id: userId,
          date: today,
          steps: steps,
          distance: distance,
          calories: caloriesBurned
        };
        
        // Include goal if provided, or preserve existing goal
        if (goalValue !== null) {
          upsertData.goal = goalValue;
        } else if (existing?.goal) {
          upsertData.goal = existing.goal;
        }
        
        // Use UPSERT to update existing record or insert new one
        // IMPORTANT: Merge step counts if existing record has higher steps (prevent overwriting with lower value)
        if (existing && existing.steps > steps) {
          // If database has higher steps, use that instead (prevent overwriting with lower value from another device)
          console.log(`⚠️ Database has higher steps (${existing.steps}) than current (${steps}), keeping database value`);
          upsertData.steps = existing.steps;
          upsertData.distance = Number(existing.distance) || ((existing.steps * 0.762) / 1000);
          upsertData.calories = Number(existing.calories) || (existing.steps * 0.04);
        }
        
        const { error } = await supabase
          .from('steps')
          .upsert(upsertData, {
            onConflict: 'user_id,date',
            ignoreDuplicates: false
          });
        
        if (error) {
          console.error('Error upserting steps:', error);
          // If upsert fails due to constraint, try to clean up duplicates first
          if (error.code === '23505' || error.message.includes('duplicate')) {
            console.log('Attempting to clean up duplicates...');
            // Try to delete old entries and insert new one
            await supabase
              .from('steps')
              .delete()
              .eq('user_id', userId)
              .eq('date', today);
            
            // Retry insert
            const { error: insertError } = await supabase
              .from('steps')
              .insert(upsertData);
            
            if (insertError) {
              console.error('Error inserting steps after cleanup:', insertError);
            }
          }
        }
      } catch (error) {
        console.error('Error saving steps to database:', error);
      } finally {
        saveStepsTimeoutRef.current = null;
      }
    }, 2000); // 2 second debounce
  }, [userId]);

  const saveGoalToDatabase = async (goalValue) => {
    if (!userId) {
      console.log('No userId available, skipping database save');
      return false;
    }
    
    try {
      // Verify session is still valid
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.log('No active session, skipping database save');
        return false;
      }
      
      // Save to step_goals table (user preference, persists across days)
      const { error } = await supabase
        .from('step_goals')
        .upsert({
          user_id: userId,
          goal: goalValue,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });
      
      if (error) {
        console.error('Error upserting goal to step_goals:', error);
        return false;
      }
      
      console.log('✅ Goal saved to step_goals table:', goalValue);
      
      // Also update today's steps entry with the goal (for historical tracking in weekly view)
      const today = getTodayDateString();
      const { data: existingRecord } = await supabase
        .from('steps')
        .select('*')
        .eq('user_id', userId)
        .eq('date', today)
        .maybeSingle();
      
      if (existingRecord) {
        // Update existing entry with new goal
        await supabase
          .from('steps')
          .update({
            goal: goalValue
          })
          .eq('user_id', userId)
          .eq('date', today);
      }
      
      return true;
    } catch (error) {
      console.error('Error saving goal to database:', error);
      return false;
    }
  };

  const loadGoalFromDatabase = async () => {
    if (!userId) return null;
    
    try {
      // Load from step_goals table (user preference, persists across days)
      const { data, error } = await supabase
        .from('step_goals')
        .select('goal')
        .eq('user_id', userId)
        .single();
      
      if (error && error.code !== 'PGRST116') {
        console.error('Error loading goal from step_goals:', error);
        return null;
      }
      
      if (data?.goal) {
        return data.goal;
      }
      
      // Fallback: check today's steps entry (for backward compatibility)
      const today = getTodayDateString();
      const { data: stepsData, error: stepsError } = await supabase
        .from('steps')
        .select('goal')
        .eq('user_id', userId)
        .eq('date', today)
        .maybeSingle();
      
      if (!stepsError && stepsData?.goal) {
        // Found goal in steps table, migrate it to step_goals
        await saveGoalToDatabase(stepsData.goal);
        return stepsData.goal;
      }
      
      return null;
    } catch (error) {
      console.error('Error loading goal from database:', error);
      return null;
    }
  };

  const loadStepsFromDatabase = async () => {
    if (!userId) return null;
    
    try {
      const today = getTodayDateString();
      const { data, error } = await supabase
        .from('steps')
        .select('*')
        .eq('user_id', userId)
        .eq('date', today)
        .single();
      
      if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
        console.error('Error loading steps from database:', error);
        return null;
      }
      
      return data;
    } catch (error) {
      console.error('Error loading steps from database:', error);
      return null;
    }
  };

  const updateStepMetrics = useCallback((newSteps) => {
    const distance = (newSteps * 0.762) / 1000;
    
    // Use personalized calorie calculation if profile available
    let caloriesBurned;
    if (userProfile?.weight && userProfile?.height) {
      caloriesBurned = calculateStepCalories(
        newSteps,
        userProfile.weight,
        userProfile.height,
        userProfile.age || 30,
        userProfile.gender || 'female'
      );
    } else {
      // Fallback to basic calculation
      caloriesBurned = newSteps * 0.04;
    }
    
    setDistanceKm(distance);
    setCalories(caloriesBurned);
    
    // Save to AsyncStorage on every update
    saveSteps(newSteps);
    
    // Save to database every step (to ensure data isn't lost on navigation)
    saveStepsToDatabase(newSteps, distance, caloriesBurned);
  }, [userId, userProfile]);

  // Get user ID and load initial data
  useEffect(() => {
    const initializeUser = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const currentUserId = session?.user?.id;
        setUserId(currentUserId);
        
        if (currentUserId) {
          // Fetch user profile for personalized calorie calculation
          const { data: profileData } = await supabase
            .from('user_profile')
            .select('weight, height, age, gender')
            .eq('id', currentUserId)
            .single();
          
          if (profileData) {
            setUserProfile(profileData);
          }
          
          // Try to load from database first (handle duplicates by getting most recent)
          const today = getTodayDateString();
          const { data: stepsData, error } = await supabase
            .from('steps')
            .select('*')
            .eq('user_id', currentUserId)
            .eq('date', today)
            .maybeSingle();
          
          // Also load from AsyncStorage to compare
          const localSteps = await loadSavedSteps();
          
          if (stepsData && !error) {
            // Use the HIGHER value between database and local storage (prevent data loss)
            const dbSteps = stepsData.steps || 0;
            const finalSteps = Math.max(dbSteps, localSteps);
            
            console.log(`Loaded steps - Database: ${dbSteps}, Local: ${localSteps}, Using: ${finalSteps}`);
            
            // If database has higher value, update local storage
            if (dbSteps > localSteps) {
              await saveSteps(dbSteps);
              setStepsToday(finalSteps);
              setDistanceKm(Number(stepsData.distance) || 0);
              setCalories(Number(stepsData.calories) || 0);
            } else if (localSteps > dbSteps) {
              // If local has higher value, sync to database
              setStepsToday(finalSteps);
              const distance = (finalSteps * 0.762) / 1000;
              let caloriesBurned;
              if (profileData?.weight && profileData?.height) {
                caloriesBurned = calculateStepCalories(
                  finalSteps,
                  profileData.weight,
                  profileData.height,
                  profileData.age || 30,
                  profileData.gender || 'female'
                );
              } else {
                caloriesBurned = finalSteps * 0.04;
              }
              setDistanceKm(distance);
              setCalories(caloriesBurned);
              // Save to database immediately
              saveStepsToDatabase(finalSteps, distance, caloriesBurned);
            } else {
              // Both are same, just use database values
              setStepsToday(finalSteps);
              setDistanceKm(Number(stepsData.distance) || 0);
              setCalories(Number(stepsData.calories) || 0);
            }
            
            // If multiple records exist, clean up duplicates
            const { data: allRecords } = await supabase
              .from('steps')
              .select('id')
              .eq('user_id', currentUserId)
              .eq('date', today);
            
            if (allRecords && allRecords.length > 1) {
              console.log(`⚠️ Found ${allRecords.length} duplicate entries for today, cleaning up...`);
              const idsToDelete = allRecords.slice(1).map(r => r.id);
              await supabase
                .from('steps')
                .delete()
                .in('id', idsToDelete);
              console.log('✅ Cleaned up duplicates');
            }
          }
        }
      } catch (error) {
        console.error('Error initializing user:', error);
      }
    };
    
    initializeUser();
  }, []);

  // FIXED: Simplified diagnostics (removed DeviceMotion and Accelerometer)
  const runDiagnostics = useCallback(async () => {
    console.log('🔍 Running pedometer diagnostics...');
    
    try {
      // Test only Pedometer (the main sensor we need)
      const pedometerAvailable = await Pedometer.isAvailableAsync();
      console.log('📱 Pedometer available:', pedometerAvailable);

      // Test permissions (Android)
      let permissionsGranted = true;
      if (Platform.OS === 'android') {
        try {
          const permissions = await Pedometer.getPermissionsAsync();
          permissionsGranted = permissions.granted;
          console.log('🔐 Permissions:', permissions);
        } catch (permError) {
          console.log('❌ Permission error:', permError);
          permissionsGranted = false;
        }
      }

      setDiagnostics({
        pedometerSupported: pedometerAvailable,
        permissionsGranted,
        sensorActive: false,
        lastEventTime: null,
        totalEvents: 0
      });

      return {
        pedometerAvailable,
        permissionsGranted
      };

    } catch (error) {
      console.error('💥 Diagnostics error:', error);
      setError(`Diagnostics failed: ${error.message}`);
      return null;
    }
  }, []);

  useEffect(() => {
    let subscription = null;
    let isComponentMounted = true;
    let isAppActive = true;
    let lastStepTime = 0;

    const initializePedometer = async () => {
      try {
        console.log('🚀 Initializing Simple Pedometer with Diagnostics');
        setDebugInfo('Running diagnostics...');
        
        // Run diagnostics
        const diagnosticResults = await runDiagnostics();
        if (!diagnosticResults) return;

        const { pedometerAvailable, permissionsGranted } = diagnosticResults;

        if (!isComponentMounted) return;
        
        setIsPedometerAvailable(pedometerAvailable);

        if (!pedometerAvailable) {
          setError(`Pedometer not supported on this ${Platform.OS} device`);
          setDebugInfo(`❌ Not supported on ${Platform.OS}`);
          
          // Load saved steps
          const savedSteps = await loadSavedSteps();
          setStepsToday(savedSteps);
          updateStepMetrics(savedSteps);
          return;
        }

        if (!permissionsGranted && Platform.OS === 'android') {
          setDebugInfo('Requesting permissions...');
          try {
            const requestResult = await Pedometer.requestPermissionsAsync();
            console.log('📝 Permission request result:', requestResult);
            
            if (!requestResult.granted) {
              setError('Motion tracking permission denied');
              setDebugInfo('❌ Permission denied');
              return;
            }
            
            // Update diagnostics
            setDiagnostics(prev => ({
              ...prev,
              permissionsGranted: true
            }));
          } catch (permError) {
            setError(`Permission error: ${permError.message}`);
            setDebugInfo('❌ Permission error');
            return;
          }
        }

        // Load saved steps from local storage
        const savedSteps = await loadSavedSteps();
        console.log('💾 Loaded saved steps from local:', savedSteps);
        
        // Also load from database to get the highest value
        // Get userId from session if not available in state yet
        let currentUserId = userId;
        if (!currentUserId) {
          try {
            const { data: { session } } = await supabase.auth.getSession();
            currentUserId = session?.user?.id;
          } catch (err) {
            console.log('Could not get userId from session:', err);
          }
        }
        
        if (currentUserId) {
          const today = getTodayDateString();
          const { data: dbStepsData } = await supabase
            .from('steps')
            .select('steps, distance, calories')
            .eq('user_id', currentUserId)
            .eq('date', today)
            .maybeSingle();
          
          const dbSteps = dbStepsData?.steps || 0;
          // Use the HIGHER value to prevent data loss
          const finalSteps = Math.max(savedSteps, dbSteps);
          
          console.log(`💾 Steps comparison - Local: ${savedSteps}, DB: ${dbSteps}, Using: ${finalSteps}`);
          
          if (isComponentMounted) {
            setStepsToday(finalSteps);
            // If database has higher value, use database metrics, otherwise calculate from finalSteps
            if (dbSteps > savedSteps && dbStepsData) {
              setDistanceKm(Number(dbStepsData.distance) || 0);
              setCalories(Number(dbStepsData.calories) || 0);
            } else {
              updateStepMetrics(finalSteps);
            }
            setDebugInfo(`Loaded: ${finalSteps} steps`);
          }
        } else {
          // No userId yet, just use local steps
          if (isComponentMounted) {
            setStepsToday(savedSteps);
            updateStepMetrics(savedSteps);
            setDebugInfo(`Loaded: ${savedSteps} steps`);
          }
        }

        // Setup step counter with ENHANCED LOGGING
        console.log('👂 Setting up ENHANCED step counter...');
        setDebugInfo('Starting step detection...');

        subscription = Pedometer.watchStepCount(stepResult => {
          const now = Date.now();
          console.log('🔥 RAW STEP EVENT RECEIVED:', {
            stepResult,
            timestamp: new Date().toLocaleTimeString(),
            timeSinceLastEvent: now - lastStepTime
          });
          
          // Update diagnostics
          setDiagnostics(prev => ({
            ...prev,
            sensorActive: true,
            lastEventTime: new Date().toLocaleTimeString(),
            totalEvents: prev.totalEvents + 1
          }));

          if (!isComponentMounted || !isAppActive) {
            console.log('🚫 Ignored - component unmounted or app inactive');
            return;
          }
          
          if (stepResult && typeof stepResult.steps === 'number') {
            const timeSinceLastStep = now - lastStepTime;
            
            console.log('🔍 Step validation:', {
              steps: stepResult.steps,
              timeSinceLastStep,
              minCount: MIN_STEP_COUNT,
              maxPerEvent: MAX_STEPS_PER_EVENT,
              cooldown: STEP_COOLDOWN
            });

            // Validation: minimum steps (filter noise)
            if (stepResult.steps < MIN_STEP_COUNT) {
              console.log('🚫 Filtered: too few steps (noise):', stepResult.steps);
              return;
            }
            
            // Validation: prevent duplicate/rapid-fire events and small movements
            if (timeSinceLastStep < STEP_COOLDOWN) {
              console.log('🚫 Filtered: too fast (small movement/noise):', timeSinceLastStep, 'ms');
              return;
            }

            // Use the actual step count from the sensor, but cap it
            // Normal walking pace: ~2 steps/second = 1 step per 500ms
            // This prevents both sensor errors and false positives from small movements
            let stepsToAdd = Math.min(stepResult.steps, MAX_STEPS_PER_EVENT);
            
            if (stepResult.steps > MAX_STEPS_PER_EVENT) {
              console.log('⚠️ Capping excessive steps:', stepResult.steps, '→', stepsToAdd);
            }
            
            // Extra validation: reject if steps seem unrealistic
            if (stepsToAdd > 3 && timeSinceLastStep < 1000) {
              console.log('🚫 Filtered: unrealistic step rate');
              return;
            }

            // VALID STEP DETECTED
            console.log('✅ VALID STEPS:', stepsToAdd, '(from sensor:', stepResult.steps, ')');
            lastStepTime = now;
            setDebugInfo(`✅ +${stepsToAdd} steps`);
            
            setStepsToday(prevSteps => {
              const newTotalSteps = prevSteps + stepsToAdd;
              console.log('📊 Total steps:', newTotalSteps);
              
              // Update metrics immediately (don't block UI)
              updateStepMetrics(newTotalSteps);
              setDebugInfo(`🚶‍♂️ ${newTotalSteps} steps`);
              
              return newTotalSteps;
            });
          } else {
            console.log('⚠️ Invalid step result format:', stepResult);
          }
        });

        // App state handling
        const handleAppStateChange = (nextAppState) => {
          console.log('📱 App state changed to:', nextAppState);
          isAppActive = nextAppState === 'active';
          
          if (nextAppState === 'active') {
            setDebugInfo('📱 App active - listening for steps');
          } else if (nextAppState === 'background') {
            setDebugInfo('📱 App background - may miss steps');
          }
        };

        const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

        console.log('✅ Enhanced pedometer initialized successfully');
        setDebugInfo('✅ Waiting for steps... Try walking!');

        return () => {
          if (subscription && typeof subscription.remove === 'function') {
            subscription.remove();
            console.log('🧹 Pedometer subscription removed');
          }
          if (appStateSubscription && typeof appStateSubscription.remove === 'function') {
            appStateSubscription.remove();
            console.log('🧹 App state subscription removed');
          }
        };

      } catch (err) {
        if (!isComponentMounted) return;
        
        console.error('💥 Pedometer initialization error:', err);
        setError(`Initialization failed: ${err.message}`);
        setDebugInfo(`💥 Error: ${err.message}`);
        
        try {
          const savedSteps = await loadSavedSteps();
          if (isComponentMounted) {
            setStepsToday(savedSteps);
            updateStepMetrics(savedSteps);
          }
        } catch (loadError) {
          console.error('Failed to load saved steps:', loadError);
        }
      }
    };

    initializePedometer();

    return () => {
      isComponentMounted = false;
    };
  }, [updateStepMetrics, runDiagnostics]);

  // Reset at midnight
  useEffect(() => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const timeUntilMidnight = tomorrow.getTime() - now.getTime();
    
    const resetTimer = setTimeout(() => {
      console.log('🌅 New day - resetting steps');
      setStepsToday(0);
      setDistanceKm(0);
      setCalories(0);
      saveSteps(0);
      setDebugInfo('🌅 New day - reset complete');
    }, timeUntilMidnight);

    return () => clearTimeout(resetTimer);
  }, []);

  const addTestSteps = useCallback(async (count = 1) => {
    console.log('🧪 MANUALLY ADDING TEST STEPS:', count);
    
    setStepsToday(prevSteps => {
      const newSteps = prevSteps + count;
      console.log('🧪 Test steps added:', count, '→ Total:', newSteps);
      
      // Calculate metrics immediately
      const distance = (newSteps * 0.762) / 1000;
      let caloriesBurned;
      if (userProfile?.weight && userProfile?.height) {
        caloriesBurned = calculateStepCalories(
          newSteps,
          userProfile.weight,
          userProfile.height,
          userProfile.age || 30,
          userProfile.gender || 'female'
        );
      } else {
        caloriesBurned = newSteps * 0.04;
      }
      
      setDistanceKm(distance);
      setCalories(caloriesBurned);
      
      // Save to AsyncStorage immediately
      saveSteps(newSteps);
      
      // Save to database IMMEDIATELY (bypass debounce for manual additions)
      saveStepsToDatabaseImmediate(newSteps, distance, caloriesBurned);
      
      setDebugInfo(`🧪 Test: ${newSteps} steps (manual)`);
      
      return newSteps;
    });
  }, [userProfile, saveStepsToDatabaseImmediate]);

  const resetSteps = useCallback(() => {
    console.log('🔄 RESETTING ALL STEPS');
    setStepsToday(0);
    setDistanceKm(0);
    setCalories(0);
    saveSteps(0);
    setDebugInfo('🔄 Reset complete - ready for new steps');
  }, []);

  const reloadStepsFromDatabase = useCallback(async () => {
    if (!userId) return;
    
    try {
      console.log('🔄 Reloading steps from database...');
      const today = getTodayDateString();
      
      // Get all records for today (to check for duplicates)
      const { data: allRecords, error: fetchError } = await supabase
        .from('steps')
        .select('*')
        .eq('user_id', userId)
        .eq('date', today);
      
      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('Error fetching steps:', fetchError);
        return;
      }
      
      if (allRecords && allRecords.length > 0) {
        // Use the most recent record
        const data = allRecords[0];
        console.log('✅ Loaded steps from database:', data.steps);
        setStepsToday(data.steps || 0);
        setDistanceKm(Number(data.distance) || 0);
        setCalories(Number(data.calories) || 0);
        
        // If duplicates exist, clean them up (keep only the most recent)
        if (allRecords.length > 1) {
          console.log(`⚠️ Found ${allRecords.length} duplicate entries, cleaning up...`);
          const idsToDelete = allRecords.slice(1).map(r => r.id);
          const { error: deleteError } = await supabase
            .from('steps')
            .delete()
            .in('id', idsToDelete);
          
          if (deleteError) {
            console.error('Error cleaning up duplicates:', deleteError);
          } else {
            console.log('✅ Cleaned up', allRecords.length - 1, 'duplicate entries');
          }
        }
      } else {
        // No record found - reset to 0
        console.log('ℹ️ No record found in database, resetting to 0');
        setStepsToday(0);
        setDistanceKm(0);
        setCalories(0);
      }
    } catch (error) {
      console.error('Error reloading steps:', error);
    }
  }, [userId]);

  const runFullDiagnostic = useCallback(() => {
    runDiagnostics();
    setDebugInfo('🔍 Running diagnostic check...');
  }, [runDiagnostics]);

  // Cleanup on unmount - save final state and clear timeout
  useEffect(() => {
    return () => {
      if (saveStepsTimeoutRef.current) {
        clearTimeout(saveStepsTimeoutRef.current);
        // Force save final state before unmounting
        if (userId && stepsToday > 0) {
          const distance = (stepsToday * 0.762) / 1000;
          let caloriesBurned;
          if (userProfile?.weight && userProfile?.height) {
            caloriesBurned = calculateStepCalories(
              stepsToday,
              userProfile.weight,
              userProfile.height,
              userProfile.age || 30,
              userProfile.gender || 'female'
            );
          } else {
            caloriesBurned = stepsToday * 0.04;
          }
          // Save synchronously on unmount
          const today = getTodayDateString();
          supabase
            .from('steps')
            .upsert({
              user_id: userId,
              date: today,
              steps: stepsToday,
              distance: distance,
              calories: caloriesBurned
            }, {
              onConflict: 'user_id,date'
            })
            .then(() => console.log('✅ Final steps saved on unmount'))
            .catch(err => console.error('❌ Error saving final steps:', err));
        }
      }
    };
  }, [userId, stepsToday, userProfile]);

  return { 
    stepsToday, 
    isPedometerAvailable, 
    distanceKm, 
    calories, 
    error,
    debugInfo,
    diagnostics,
    addTestSteps,
    resetSteps,
    reloadStepsFromDatabase,
    runFullDiagnostic,
    saveGoalToDatabase,
    loadGoalFromDatabase
  };
};

export default useTodaySteps;